import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/file_browser_manager.dart';
import 'package:uxnan/domain/entities/file_browser.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

const _listResult = <String, dynamic>{
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

Future<void> _settle() =>
    Future<void>.delayed(const Duration(milliseconds: 40));

void main() {
  late Map<String, Map<String, dynamic>> calls;
  late StreamController<RpcMessage> controller;
  late Completer<RpcMessage> listCompleter;
  late FileBrowserManager manager;

  setUp(() {
    calls = <String, Map<String, dynamic>>{};
    controller = StreamController<RpcMessage>.broadcast();
    listCompleter = Completer<RpcMessage>();
    manager = FileBrowserManager(
      sendRequest: (method, [params]) {
        calls[method] = params ?? const <String, dynamic>{};
        return switch (method) {
          'workspace/list' => listCompleter.future,
          'git/status' => Future.value(
              RpcMessage.response(id: '1', result: _statusResult),
            ),
          _ => Future.value(
              RpcMessage.response(id: '1', result: const <String, dynamic>{}),
            ),
        };
      },
    );
  });

  tearDown(() async {
    await manager.dispose();
    await controller.close();
  });

  test('loadRoot lists the directory and applies git status', () async {
    listCompleter.complete(
      RpcMessage.response(id: '1', result: _listResult),
    );
    await manager.loadRoot('/repo');
    await _settle();
    final root = manager.rootFor('/repo');
    expect(root, isNotNull);
    expect(root!.children, hasLength(4));
    // Git status arrives after the list and paints the matching files.
    await _settle();
    final updated = manager.rootFor('/repo')!;
    final readme = updated.children
        .firstWhere((c) => c.basename == 'README.md');
    final src = updated.children.firstWhere((c) => c.basename == 'src');
    expect(readme.gitStatus, GitFileStatus.modified);
    expect(src.gitStatus, isNull);
  });

  test('toggleDirectory fetches children lazily on expand', () async {
    listCompleter.complete(
      RpcMessage.response(id: '1', result: _listResult),
    );
    await manager.loadRoot('/repo');
    await _settle();
    // Switch the in-flight list completer so the second call uses the
    // nested-directory payload.
    final next = Completer<RpcMessage>();
    listCompleter = next;
    next.complete(
      RpcMessage.response(id: '2', result: _listSrcResult),
    );
    await manager.toggleDirectory('/repo', 'src');
    await _settle();
    final src = manager
        .rootFor('/repo')!
        .children
        .firstWhere((c) => c.basename == 'src');
    expect(src.expanded, isTrue);
    expect(src.children, hasLength(2));
    final main = src.children.firstWhere((c) => c.basename == 'main.dart');
    expect(main.path, 'src/main.dart');
  });

  test('readFile returns the parsed content', () async {
    listCompleter.complete(
      RpcMessage.response(id: '1', result: const {'cwd': '.', 'entries': []}),
    );
    await manager.loadRoot('/repo');
    final result = await manager.readFile('/repo', 'README.md');
    // Default stub returns an empty map; just verify the shape is parsed.
    expect(result.path, '');
    expect(result.encoding, FileEncoding.utf8);
  });

  test('readImage decodes the payload', () async {
    final completer = Completer<RpcMessage>();
    final imageManager = FileBrowserManager(
      sendRequest: (method, [params]) {
        if (method == 'workspace/readImage') {
          return completer.future;
        }
        return Future.value(
          RpcMessage.response(id: '1', result: const <String, dynamic>{}),
        );
      },
    );
    completer.complete(
      RpcMessage.response(
        id: '1',
        result: const {
          'path': 'logo.png',
          'base64Data': 'aGVsbG8=',
          'mimeType': 'image/png',
        },
      ),
    );
    final image = await imageManager.readImage('/repo', 'logo.png');
    expect(image.mimeType, 'image/png');
    expect(image.base64Data, 'aGVsbG8=');
    await imageManager.dispose();
  });

  test('fileDiff returns the unified diff text', () async {
    final completer = Completer<RpcMessage>();
    final diffManager = FileBrowserManager(
      sendRequest: (method, [params]) {
        if (method == 'git/diff') return completer.future;
        return Future.value(
          RpcMessage.response(id: '1', result: const <String, dynamic>{}),
        );
      },
    );
    completer.complete(
      RpcMessage.response(
        id: '1',
        result: const {'diff': '--- a\n+++ b\n@@\n-old\n+new\n'},
      ),
    );
    final diff = await diffManager.fileDiff('/repo', 'src/main.dart');
    expect(diff, contains('+new'));
    expect(diff, contains('-old'));
    await diffManager.dispose();
  });

  test('refreshGitStatus silently tolerates non-git cwds', () async {
    final failingManager = FileBrowserManager(
      sendRequest: (method, [params]) async {
        if (method == 'git/status') {
          throw StateError('not a git repo');
        }
        return RpcMessage.response(
          id: '1',
          result: const <String, dynamic>{},
        );
      },
    );
    // No throw — best-effort semantics.
    await failingManager.refreshGitStatus('/not-a-repo');
    await failingManager.dispose();
  });
}
