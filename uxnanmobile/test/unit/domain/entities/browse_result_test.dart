import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/browse_result.dart';

void main() {
  group('BrowseResult.fromJson', () {
    test('parses a full payload', () {
      final result = BrowseResult.fromJson({
        'roots': [
          {'id': 'r1', 'name': 'Documents', 'cwd': '/home/me/Documents'},
          {'id': 'r2', 'name': 'Code', 'cwd': '/home/me/Code'},
        ],
        'rootId': 'r1',
        'path': 'projects/foo',
        'parent': 'projects',
        'cwd': '/home/me/Documents/projects/foo',
        'isGitRepo': true,
        'dirs': [
          {'name': 'src', 'path': 'projects/foo/src', 'isGitRepo': false},
          {'name': 'lib', 'path': 'projects/foo/lib', 'isGitRepo': true},
        ],
      });
      expect(result, isNotNull);
      expect(result!.roots.map((r) => r.id), ['r1', 'r2']);
      expect(result.rootId, 'r1');
      expect(result.path, 'projects/foo');
      expect(result.parent, 'projects');
      expect(result.cwd, '/home/me/Documents/projects/foo');
      expect(result.isGitRepo, isTrue);
      expect(result.dirs.length, 2);
      expect(result.dirs[1].isGitRepo, isTrue);
    });

    test('is tolerant: null parent at root, missing/garbage fields', () {
      final result = BrowseResult.fromJson({
        'rootId': 'r1',
        'cwd': '/root',
        'parent': null,
        // no roots, no dirs, no path, no isGitRepo
        'dirs': [
          {'name': 'ok', 'path': 'ok'},
          'garbage',
          {'name': 'noPath'},
        ],
      });
      expect(result, isNotNull);
      expect(result!.path, '');
      expect(result.parent, isNull);
      expect(result.isGitRepo, isFalse);
      expect(result.roots, isEmpty);
      // Only the well-formed dir entry survives.
      expect(result.dirs.map((d) => d.name), ['ok']);
    });

    test('returns null without a rootId or cwd', () {
      expect(BrowseResult.fromJson({'cwd': '/x'}), isNull);
      expect(BrowseResult.fromJson({'rootId': 'r'}), isNull);
      expect(BrowseResult.fromJson('nope'), isNull);
    });
  });
}
