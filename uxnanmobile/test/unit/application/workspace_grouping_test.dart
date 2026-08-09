import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/git/git_worktree_entry.dart';

/// The whole project → workspace hierarchy is inferred from paths, so these
/// cases are the awkward real ones: Windows separators, casing, nested roots,
/// and the worktree layout that deliberately does NOT resolve yet.
void main() {
  _worktreeTests();
  _worktreeOrderingTests();
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

/// The worktree hierarchy, which the phone is now TOLD rather than inferring.
///
/// The whole point of the `git/worktrees` contract is that a worktree is a
/// SIBLING on disk — `/dev/app` and `/dev/app-feature` share a prefix with
/// every other folder in `/dev` and nothing else. So these cases pin two
/// things: that a real relationship is drawn, and that a missing one is never
/// invented.
void _worktreeTests() {
  Thread thread(String id, {String? cwd}) => Thread(
        id: id,
        title: id,
        agentId: 'claude-code',
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
        cwd: cwd,
      );

  GitWorktreeEntry wt(String path, {bool main = false, String? branch}) =>
      GitWorktreeEntry(path: path, isMain: main, branch: branch);

  test('a reply relates every sibling it names', () {
    final table = buildWorkspaceRepoTable({
      '/dev/app': [
        wt('/dev/app', main: true, branch: 'main'),
        wt('/dev/app-feature', branch: 'feature'),
      ],
    });

    expect(table['/dev/app']!.key, '/dev/app');
    expect(table['/dev/app-feature']!.key, '/dev/app');
    expect(table['/dev/app-feature']!.label, 'app');
  });

  test('a repository with one worktree relates nothing', () {
    // Nothing to draw a heading over, so no table entry and no group later.
    final table = buildWorkspaceRepoTable({
      '/dev/solo': [wt('/dev/solo', main: true, branch: 'main')],
    });
    expect(table, isEmpty);
  });

  test('paths are matched folded, like everywhere else', () {
    final table = buildWorkspaceRepoTable({
      r'C:\Dev\App': [
        wt(r'C:\Dev\App', main: true),
        wt(r'C:\Dev\App-feature'),
      ],
    });
    expect(table[normalizeWorkspacePath('c:/dev/app-feature/')], isNotNull);
  });

  test('two folders of one repo become a repository node', () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: '/dev/app'),
        thread('t2', cwd: '/dev/app-feature'),
      ],
      projects: const [],
      repos: buildWorkspaceRepoTable({
        '/dev/app': [wt('/dev/app', main: true), wt('/dev/app-feature')],
      }),
    );
    final tree = buildWorkspaceTree(groups);

    expect(tree, hasLength(1));
    final node = tree.single as RepoWithWorktrees;
    expect(node.repo.label, 'app');
    expect(node.repo.workspaces, hasLength(2));
    // The main worktree leads: it is the one a person calls "the repo".
    expect(node.repo.workspaces.first.key, '/dev/app');
  });

  test('a folder alone in its repo stays a lone row, not a heading over one',
      () {
    // This is the shape that got the first project level removed: a heading
    // over a single folder is chrome, not structure.
    final groups = groupThreadsByWorkspace(
      threads: [thread('t1', cwd: '/dev/app')],
      projects: const [],
      repos: buildWorkspaceRepoTable({
        '/dev/app': [wt('/dev/app', main: true), wt('/dev/app-feature')],
      }),
    );
    final tree = buildWorkspaceTree(groups);

    expect(tree.single, isA<LoneWorkspace>());
  });

  test('unrelated folders are never swept into a bucket', () {
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: '/dev/app'),
        thread('t2', cwd: '/dev/app-feature'),
        thread('t3', cwd: '/elsewhere/notes'),
      ],
      projects: const [],
      repos: buildWorkspaceRepoTable({
        '/dev/app': [wt('/dev/app', main: true), wt('/dev/app-feature')],
      }),
    );
    final tree = buildWorkspaceTree(groups);

    expect(tree.whereType<RepoWithWorktrees>(), hasLength(1));
    final lone = tree.whereType<LoneWorkspace>().toList();
    expect(lone, hasLength(1));
    expect(lone.single.workspace.key, '/elsewhere/notes');
  });

  test('without a table the list is exactly what it was before', () {
    // An older bridge answers "method not found", loadWorktrees returns [], the
    // table is empty — and nothing about the flat list may change.
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: '/dev/app'),
        thread('t2', cwd: '/dev/app-feature'),
      ],
      projects: const [],
    );
    final tree = buildWorkspaceTree(groups);

    expect(tree.whereType<RepoWithWorktrees>(), isEmpty);
    expect(tree, hasLength(2));
  });

  test('a shared path prefix is NOT a relationship', () {
    // `/dev/app` and `/dev/other` share `/dev`. Before the contract this was
    // the only signal available, and it was wrong; it must stay unused.
    final groups = groupThreadsByWorkspace(
      threads: [
        thread('t1', cwd: '/dev/app'),
        thread('t2', cwd: '/dev/other'),
      ],
      projects: const [],
    );
    expect(buildWorkspaceTree(groups).whereType<RepoWithWorktrees>(), isEmpty);
  });
}

/// The ordering of worktrees INSIDE a project — the one list the sort menu
/// could not reach, because the tree sorted them itself.
void _worktreeOrderingTests() {
  Thread thread(String id, {String? cwd}) => Thread(
        id: id,
        title: id,
        agentId: 'claude-code',
        syncState: ThreadSyncState.synced,
        status: ThreadStatus.active,
        cwd: cwd,
      );

  GitWorktreeEntry wt(String path, {bool main = false}) =>
      GitWorktreeEntry(path: path, isMain: main);

  List<WorkspaceGroup> repoOf(List<String> folders) => groupThreadsByWorkspace(
        threads: [
          for (var i = 0; i < folders.length; i++)
            thread('t$i', cwd: folders[i]),
        ],
        projects: const [],
        repos: buildWorkspaceRepoTable({
          folders.first: [
            for (var i = 0; i < folders.length; i++)
              wt(folders[i], main: i == 0),
          ],
        }),
      );

  test('without a comparator the main worktree still leads', () {
    final tree = buildWorkspaceTree(
      repoOf(['/dev/app', '/dev/app-zebra', '/dev/app-alpha']),
    );
    final repo = tree.whereType<RepoWithWorktrees>().single;
    expect(repo.repo.workspaces.first.key, '/dev/app');
  });

  test('a comparator decides the order inside the project', () {
    final tree = buildWorkspaceTree(
      repoOf(['/dev/app', '/dev/app-zebra', '/dev/app-alpha']),
      orderWorkspaces: (a, b) => a.label.compareTo(b.label),
    );
    final repo = tree.whereType<RepoWithWorktrees>().single;
    expect(
      repo.repo.workspaces.map((w) => w.label).toList(),
      ['app', 'app-alpha', 'app-zebra'],
      reason: 'the project ignored the ordering it was handed',
    );
  });

  test('the comparator can put the main worktree last', () {
    // Proves the tree is not silently re-applying its own main-first rule on
    // top of what the caller asked for.
    final tree = buildWorkspaceTree(
      repoOf(['/dev/app', '/dev/app-alpha']),
      orderWorkspaces: (a, b) => b.label.compareTo(a.label),
    );
    final repo = tree.whereType<RepoWithWorktrees>().single;
    expect(repo.repo.workspaces.last.key, '/dev/app');
  });
}
