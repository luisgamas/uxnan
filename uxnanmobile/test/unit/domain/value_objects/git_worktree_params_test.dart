import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/git/git_action_io.dart';

void main() {
  group('GitWorktreeParams.toRpcParams', () {
    test('omits path entirely when the bridge is to choose it', () {
      const params = GitWorktreeParams(cwd: '/repo', branch: 'feat/x');
      final rpc = params.toRpcParams();

      // Absent, not null: a bridge that requires `path` should answer "missing
      // param", which reads better than a type error on an explicit null.
      expect(rpc.containsKey('path'), isFalse);
      expect(rpc, {'cwd': '/repo', 'branch': 'feat/x', 'managed': true});
    });

    test('sends the path when one is given (older bridge fallback)', () {
      const params = GitWorktreeParams(
        cwd: '/repo',
        branch: 'feat/x',
        path: '/repo--feat-x',
        managed: false,
      );

      expect(params.toRpcParams(), {
        'cwd': '/repo',
        'branch': 'feat/x',
        'path': '/repo--feat-x',
        'managed': false,
      });
    });

    test('threadId stays local and never reaches the wire', () {
      const params = GitWorktreeParams(
        cwd: '/repo',
        branch: 'x',
        threadId: 'th1',
      );
      expect(params.toRpcParams().containsKey('threadId'), isFalse);
    });
  });

  group('managedWorktreePath', () {
    test('matches the desktop spelling, two dashes and all', () {
      // The phone used to build `<repo>-<branch>` with its own slug rule, so
      // the same repository and branch landed in two different folders
      // depending on which app created the worktree.
      expect(
        managedWorktreePath('/home/me/uxnan', 'feat/github'),
        '/home/me/uxnan--feat-github',
      );
      expect(
        managedWorktreePath('C:/code/uxnan', 'pr-42'),
        'C:/code/uxnan--pr-42',
      );
    });

    test('keeps the separator style of the cwd it was given', () {
      expect(
        managedWorktreePath(r'C:\code\uxnan', 'pr-42'),
        r'C:\code\uxnan--pr-42',
      );
    });

    test('ignores a trailing separator on the repo path', () {
      expect(managedWorktreePath('/code/uxnan/', 'pr-1'), '/code/uxnan--pr-1');
    });

    test('handles a bare repo name with no parent', () {
      expect(managedWorktreePath('uxnan', 'pr-1'), 'uxnan--pr-1');
    });
  });
}
