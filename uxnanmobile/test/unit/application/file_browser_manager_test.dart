import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/application/services/git_status_bus.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_status_change.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// Absolute workspace root the test fixtures use. Matches the shape the
/// `ConversationScreen` reads from a thread (the bridge-resolved absolute
/// path of the thread's `cwd`).
const _workspaceRoot = '/home/user/proj';

const _listRootResult = <String, dynamic>{
  'cwd': '.',
  'entries': [
    {'name': 'src', 'type': 'dir'},
    {'name': 'README.md', 'type': 'file', 'size': 1024},
    {'name': '.gitignore', 'type': 'file', 'size': 32},
    {'name': 'pubspec.yaml', 'type': 'file', 'size': 256},
  ],
};

const _listSrcResult = <String, dynamic>{
  'cwd': 'src',
  'entries': [
    {'name': 'main.dart', 'type': 'file', 'size': 4096},
    {'name': 'utils.dart', 'type': 'file', 'size': 2048},
  ],
};

const _statusResult = <String, dynamic>{
  'branch': 'main',
  'isDirty': true,
  'files': [
    {'path': 'src/main.dart', 'status': 'modified'},
    {'path': 'README.md', 'status': 'modified'},
  ],
};

const _emptyList = <String, dynamic>{'cwd': '.', 'entries': <dynamic>[]};

FileBrowserManager _buildManager({
  required void Function(String method, Map<String, dynamic> params) onCall,
  required RpcMessage Function(String, Map<String, dynamic>) responder,
  GitStatusBus? statusBus,
}) {
  return FileBrowserManager(
    sendRequest: (method, [params]) {
      onCall(method, params ?? const <String, dynamic>{});
      return Future.value(
        responder(method, params ?? const <String, dynamic>{}),
      );
    },
    statusBus: statusBus,
  );
}

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 40));

void main() {
  test('loadRoot sends the absolute cwd and applies git status', () async {
    final sentParams = <Map<String, dynamic>>[];
    final manager = _buildManager(
      onCall: (m, p) {
        if (m == 'workspace/list' || m == 'git/status') sentParams.add(p);
      },
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _listRootResult);
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: '2', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();

    // The bridge must receive the absolute path, not a relative one.
    expect(sentParams[0]['cwd'], _workspaceRoot);
    expect(sentParams[1]['cwd'], _workspaceRoot);

    final root = manager.rootFor(_workspaceRoot);
    expect(root, isNotNull);
    expect(root!.children, hasLength(4));
    await _settle();
    final readme = manager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'README.md');
    final src = manager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'src');
    expect(readme.gitStatus, GitFileStatus.modified);
    // `src/` aggregates the status of its changed descendant (`src/main.dart`
    // is modified) so the folder colours even while still collapsed.
    expect(src.gitStatus, GitFileStatus.modified);
    await manager.dispose();
  });

  test('directories aggregate descendant git status', () async {
    const statusResult = <String, dynamic>{
      'branch': 'main',
      'isDirty': true,
      'files': [
        // Only untracked changes under `assets/` → the folder is untracked.
        {'path': 'assets/new.png', 'status': 'untracked'},
        // A tracked change under `src/` → the folder is modified.
        {'path': 'src/main.dart', 'status': 'modified'},
      ],
    };
    const listRoot = <String, dynamic>{
      'cwd': '.',
      'entries': [
        {'name': 'assets', 'type': 'dir'},
        {'name': 'src', 'type': 'dir'},
        {'name': 'docs', 'type': 'dir'},
      ],
    };
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: listRoot);
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: '2', result: statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();

    final children = manager.rootFor(_workspaceRoot)!.children;
    final assets = children.firstWhere((c) => c.basename == 'assets');
    final src = children.firstWhere((c) => c.basename == 'src');
    final docs = children.firstWhere((c) => c.basename == 'docs');
    expect(assets.gitStatus, GitFileStatus.untracked);
    expect(src.gitStatus, GitFileStatus.modified);
    expect(docs.gitStatus, isNull);
    await manager.dispose();
  });

  test('writeFile applies a modify patch and refreshes git status', () async {
    final calls = <({String method, Map<String, dynamic> params})>[];
    final manager = _buildManager(
      onCall: (m, p) => calls.add((method: m, params: p)),
      responder: (m, _) {
        if (m == 'workspace/applyPatch') {
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{'success': true, 'applied': 1},
          );
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: '2', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    await manager.writeFile(_workspaceRoot, 'README.md', 'hello');
    await _settle();

    final patch = calls.firstWhere((c) => c.method == 'workspace/applyPatch');
    expect(patch.params['cwd'], _workspaceRoot);
    final changes = patch.params['changes'] as List;
    expect(changes, hasLength(1));
    final change = changes.first as Map;
    expect(change['op'], 'modify');
    expect(change['path'], 'README.md');
    expect(change['content'], 'hello');
    // The write must trigger a git status refresh so the tree repaints.
    expect(calls.any((c) => c.method == 'git/status'), isTrue);
    await manager.dispose();
  });

  test('toggleDirectory sends the absolute nested path', () async {
    // Queue two responses: first for the root, then for the `src` child.
    final queue = <Map<String, dynamic>>[_listRootResult, _listSrcResult];
    final listCalls = <Map<String, dynamic>>[];
    final manager = _buildManager(
      onCall: (m, p) {
        if (m == 'workspace/list') listCalls.add(p);
      },
      responder: (m, _) {
        if (m == 'workspace/list' && queue.isNotEmpty) {
          return RpcMessage.response(
            id: '${queue.length}',
            result: queue.removeAt(0),
          );
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: 'g', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();
    listCalls.clear();

    await manager.toggleDirectory(_workspaceRoot, 'src');
    await _settle();

    // The toggle-driven list call must use the joined absolute path.
    expect(listCalls, isNotEmpty);
    expect(listCalls.first['cwd'], '$_workspaceRoot/src');
    await manager.dispose();
  });

  test('collapseAll clears expansion but keeps fetched children', () async {
    final queue = <Map<String, dynamic>>[_listRootResult, _listSrcResult];
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list' && queue.isNotEmpty) {
          return RpcMessage.response(
            id: '${queue.length}',
            result: queue.removeAt(0),
          );
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: 'g', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();
    await manager.toggleDirectory(_workspaceRoot, 'src');
    await _settle();

    final expandedSrc = manager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'src');
    expect(expandedSrc.expanded, isTrue);
    expect(expandedSrc.children, isNotEmpty);

    manager.collapseAll(_workspaceRoot);

    final collapsedSrc = manager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'src');
    expect(collapsedSrc.expanded, isFalse);
    // Children stay cached so re-expanding is instant (no re-list).
    expect(collapsedSrc.children, isNotEmpty);
    await manager.dispose();
  });

  test('toggleDirectory marks a non-existent folder with an error', () async {
    var listCalls = 0;
    final failingManager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          listCalls += 1;
          if (listCalls == 1) {
            return RpcMessage.response(id: '1', result: _listRootResult);
          }
          // The real bridge raises an RpcError for inaccessible paths; the
          // session coordinator's `sendRequest` propagates it. The test
          // mirrors that by throwing instead of returning a result envelope.
          throw const RpcError(
            code: -32001,
            message: 'directory not accessible',
          );
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: 'g', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await failingManager.loadRoot(_workspaceRoot);
    await _settle();

    // Should NOT throw — the manager surfaces the error on the node.
    await failingManager.toggleDirectory(_workspaceRoot, 'src');
    await _settle();

    final src = failingManager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'src');
    expect(src.error, isNotNull);
    expect(src.error, contains('directory not accessible'));
    await failingManager.dispose();
  });

  test('loadRoot stores the error on the node when the bridge refuses',
      () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          throw const RpcError(
            code: -32004,
            message: 'WorkspaceAccessDenied',
          );
        }
        if (m == 'git/status') {
          return RpcMessage.response(id: 'g', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();

    final root = manager.rootFor(_workspaceRoot);
    expect(root, isNotNull);
    expect(root!.error, contains('WorkspaceAccessDenied'));
    await manager.dispose();
  });

  test('readFile returns the parsed content', () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _emptyList);
        }
        if (m == 'workspace/readFile') {
          return RpcMessage.response(
            id: '2',
            result: const {
              'path': 'README.md',
              'content': '# hello',
              'encoding': 'utf-8',
            },
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await manager.loadRoot(_workspaceRoot);
    final result = await manager.readFile(_workspaceRoot, 'README.md');
    expect(result.path, 'README.md');
    expect(result.content, '# hello');
    expect(result.encoding, FileEncoding.utf8);
    await manager.dispose();
  });

  test('readFile throws FileReadException on a malformed payload', () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _emptyList);
        }
        if (m == 'workspace/readFile') {
          return RpcMessage.response(id: '2', result: 'not-a-map');
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await manager.loadRoot(_workspaceRoot);
    expect(
      () => manager.readFile(_workspaceRoot, 'README.md'),
      throwsA(isA<FileReadException>()),
    );
    await manager.dispose();
  });

  test('readImage decodes the payload', () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _emptyList);
        }
        if (m == 'workspace/readImage') {
          return RpcMessage.response(
            id: '2',
            result: const {
              'path': 'logo.png',
              'base64Data': 'aGVsbG8=',
              'mimeType': 'image/png',
            },
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await manager.loadRoot(_workspaceRoot);
    final image = await manager.readImage(_workspaceRoot, 'logo.png');
    expect(image.mimeType, 'image/png');
    expect(image.base64Data, 'aGVsbG8=');
    await manager.dispose();
  });

  test('fileDiff returns the unified diff text', () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _emptyList);
        }
        if (m == 'git/diff') {
          return RpcMessage.response(
            id: '2',
            result: const {'diff': '--- a\n+++ b\n@@\n-old\n+new\n'},
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await manager.loadRoot(_workspaceRoot);
    final diff = await manager.fileDiff(_workspaceRoot, 'src/main.dart');
    expect(diff, contains('+new'));
    expect(diff, contains('-old'));
    await manager.dispose();
  });

  test('refreshGitStatus silently tolerates non-git cwds', () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'git/status') {
          throw StateError('not a git repo');
        }
        return RpcMessage.response(
          id: '1',
          result: const <String, dynamic>{},
        );
      },
    );
    // No throw — best-effort semantics.
    await manager.refreshGitStatus('/not-a-repo');
    await manager.dispose();
  });

  test('invalidate clears the cached tree', () async {
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _listRootResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
    );
    await manager.loadRoot(_workspaceRoot);
    expect(manager.rootFor(_workspaceRoot), isNotNull);
    manager.invalidate(_workspaceRoot);
    expect(manager.rootFor(_workspaceRoot), isNull);
    await manager.dispose();
  });

  test('bus emission repaints the tree for a managed cwd', () async {
    final bus = GitStatusBus();
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'workspace/list') {
          return RpcMessage.response(id: '1', result: _listRootResult);
        }
        if (m == 'git/status') {
          // Initial fetch: tree is clean (the bug we are fixing started
          // with a non-clean state cached from a prior session).
          return RpcMessage.response(
            id: '1',
            result: const <String, dynamic>{
              'branch': 'main',
              'isDirty': false,
              'files': <dynamic>[],
            },
          );
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
      statusBus: bus,
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();
    final readme = manager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'README.md');
    final src = manager
        .rootFor(_workspaceRoot)!
        .children
        .firstWhere((c) => c.basename == 'src');
    expect(readme.gitStatus, isNull);
    expect(src.gitStatus, isNull);

    // External producer (e.g. a CLI commit on the PC) emits a fresh
    // GitStatusChange for the same cwd. The manager must repaint without
    // us touching the API — the modified descendant under `src/` flips
    // the folder to the modified colour even while collapsed.
    bus.emit(
      const GitStatusChange(
        cwd: _workspaceRoot,
        state: GitRepoState(
          branch: 'main',
          isDirty: true,
          changedFiles: [
            GitChangedFile(
              path: 'src/main.dart',
              status: GitFileStatus.modified,
            ),
          ],
        ),
      ),
    );
    await _settle();

    final root = manager.rootFor(_workspaceRoot)!;
    final srcAfter = root.children.firstWhere((c) => c.basename == 'src');
    final readmeAfter =
        root.children.firstWhere((c) => c.basename == 'README.md');
    expect(srcAfter.gitStatus, GitFileStatus.modified);
    expect(readmeAfter.gitStatus, isNull);

    await manager.dispose();
    await bus.dispose();
  });

  test('bus emission for an unknown cwd is ignored', () async {
    final bus = GitStatusBus();
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) => RpcMessage.response(
        id: '1',
        result: const <String, dynamic>{},
      ),
      statusBus: bus,
    );

    // No loadRoot — the manager does not manage this cwd.
    bus.emit(
      const GitStatusChange(
        cwd: '/some/other/workspace',
        state: GitRepoState(
          branch: 'main',
          changedFiles: [
            GitChangedFile(path: 'a.dart', status: GitFileStatus.modified),
          ],
        ),
      ),
    );
    await _settle();
    // No throw, no crash. Nothing to assert beyond that.
    expect(manager.rootFor('/some/other/workspace'), isNull);

    await manager.dispose();
    await bus.dispose();
  });

  test('refreshGitStatus publishes the new state on the bus', () async {
    final bus = GitStatusBus();
    final received = <GitStatusChange>[];
    final sub = bus.changes.listen(received.add);
    final manager = _buildManager(
      onCall: (_, __) {},
      responder: (m, _) {
        if (m == 'git/status') {
          return RpcMessage.response(id: 'g', result: _statusResult);
        }
        return RpcMessage.response(id: '1', result: const <String, dynamic>{});
      },
      statusBus: bus,
    );

    await manager.loadRoot(_workspaceRoot);
    await _settle();

    // loadRoot triggers exactly one refresh, which emits exactly once.
    expect(received, hasLength(1));
    expect(received.single.cwd, _workspaceRoot);
    expect(received.single.state.changedFiles, hasLength(2));
    final paths = received.single.state.changedFiles.map((f) => f.path).toSet();
    expect(paths, containsAll(<String>{'src/main.dart', 'README.md'}));

    await manager.dispose();
    await sub.cancel();
    await bus.dispose();
  });
}
