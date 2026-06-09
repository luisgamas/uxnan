import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/workspace_browser.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

void main() {
  test('WorkspaceBrowser.browse parses a browseDirs result', () async {
    String? sentMethod;
    Map<String, dynamic>? sentParams;
    final browser = WorkspaceBrowser((method, [params]) async {
      sentMethod = method;
      sentParams = params;
      return RpcMessage.response(
        id: '1',
        result: const {
          'roots': [
            {'id': 'r1', 'name': 'Docs', 'cwd': '/docs'},
          ],
          'rootId': 'r1',
          'path': 'a',
          'parent': '',
          'cwd': '/docs/a',
          'isGitRepo': false,
          'dirs': [
            {'name': 'b', 'path': 'a/b', 'isGitRepo': true},
          ],
        },
      );
    });

    final result = await browser.browse(rootId: 'r1', path: 'a');

    expect(sentMethod, 'workspace/browseDirs');
    expect(sentParams, {'rootId': 'r1', 'path': 'a'});
    expect(result, isNotNull);
    expect(result!.cwd, '/docs/a');
    expect(result.dirs.single.name, 'b');
    expect(result.dirs.single.isGitRepo, isTrue);
  });

  test('WorkspaceBrowser.browse returns null on a non-map result', () async {
    final browser = WorkspaceBrowser(
      (method, [params]) async => RpcMessage.response(id: '1'),
    );
    expect(await browser.browse(), isNull);
  });
}
