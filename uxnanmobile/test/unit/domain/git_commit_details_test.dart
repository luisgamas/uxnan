import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_commit_details.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';

void main() {
  group('GitCommit.refs', () {
    test('parses ref decoration into typed refs', () {
      final commit = GitCommit.fromJson(const {
        'sha': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'shortSha': 'aaaaaaa',
        'parents': <String>[],
        'messageTitle': 'init',
        'messageBody': '',
        'refs': [
          {'name': 'HEAD', 'type': 'head'},
          {'name': 'main', 'type': 'branch'},
          {'name': 'origin/main', 'type': 'remoteBranch'},
          {'name': 'v1.0.0', 'type': 'tag'},
        ],
      });
      expect(commit.refs, hasLength(4));
      expect(commit.refs[0].type, GitRefType.head);
      expect(commit.refs[1].type, GitRefType.branch);
      expect(commit.refs[2].type, GitRefType.remoteBranch);
      expect(commit.refs[3].name, 'v1.0.0');
      expect(commit.refs[3].type, GitRefType.tag);
    });

    test('defaults to no refs and drops nameless entries', () {
      final commit = GitCommit.fromJson(const {
        'sha': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        'refs': [
          {'type': 'branch'},
          {'name': '', 'type': 'tag'},
        ],
      });
      expect(commit.refs, isEmpty);
    });
  });

  group('GitCommitDetails.fromJson', () {
    test('parses commit, files (incl. rename) and diff flags', () {
      final details = GitCommitDetails.fromJson(const {
        'commit': {
          'sha': 'cccccccccccccccccccccccccccccccccccccccc',
          'messageTitle': 'rework',
          'messageBody': 'body',
        },
        'files': [
          {
            'path': 'lib/new.dart',
            'oldPath': 'lib/old.dart',
            'status': 'renamed',
            'additions': 3,
            'deletions': 1,
          },
          {'path': 'README.md', 'status': 'modified', 'additions': 2},
          {'path': 'logo.png', 'status': 'added', 'binary': true},
        ],
        'diff': '--- a\n+++ b\n+x\n',
        'diffTruncated': true,
      });
      expect(details.commit.messageTitle, 'rework');
      expect(details.files, hasLength(3));
      final renamed = details.files.first;
      expect(renamed.status, GitFileStatus.renamed);
      expect(renamed.oldPath, 'lib/old.dart');
      expect(renamed.additions, 3);
      expect(details.files[2].binary, isTrue);
      expect(details.diffTruncated, isTrue);
      expect(details.diff, contains('+x'));
    });

    test('tolerates a missing commit object', () {
      final details = GitCommitDetails.fromJson(const {'diff': ''});
      expect(details.commit.sha, isEmpty);
      expect(details.files, isEmpty);
      expect(details.diffTruncated, isFalse);
    });
  });
}
