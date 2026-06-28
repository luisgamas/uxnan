import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/git/git_log.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_history_screen.dart';

/// Two commits used across the filter tests: one feature commit authored by
/// Luis with a `main` ref, and an unrelated chore commit by Ana.
List<GitCommit> _commits() => const [
      GitCommit(
        sha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
        shortSha: 'a1b2c3d',
        parents: ['0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f'],
        authorName: 'Luis',
        authorEmail: 'luis@example.com',
        authorTimestamp: 1735689600,
        committerName: 'Luis',
        committerEmail: 'luis@example.com',
        committerTimestamp: 1735689600,
        messageTitle: 'feat: history view',
        messageBody: 'adds the new screen',
        refs: [GitRef(name: 'main', type: GitRefType.branch)],
      ),
      GitCommit(
        sha: '0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f',
        shortSha: '0f0f0f0',
        parents: [],
        authorName: 'Ana',
        authorEmail: 'ana@example.com',
        authorTimestamp: 1735603200,
        committerName: 'Ana',
        committerEmail: 'ana@example.com',
        committerTimestamp: 1735603200,
        messageTitle: 'chore: initial commit',
        messageBody: '',
      ),
    ];

void main() {
  group('matchCommits', () {
    test('an empty query returns the full list unchanged', () {
      final commits = _commits();
      expect(matchCommits(commits, ''), equals(commits));
      expect(matchCommits(commits, '   '), equals(commits));
    });

    test('matches the message title (case-insensitive)', () {
      final results = matchCommits(_commits(), 'HISTORY');
      expect(results, hasLength(1));
      expect(results.single.messageTitle, 'feat: history view');
    });

    test('matches the message body', () {
      final results = matchCommits(_commits(), 'new screen');
      expect(results, hasLength(1));
      expect(results.single.messageTitle, 'feat: history view');
    });

    test('matches the full SHA and the short SHA', () {
      expect(matchCommits(_commits(), '0f0f0f0'), hasLength(1));
      expect(
        matchCommits(_commits(), '0f0f0f0').single.messageTitle,
        'chore: initial commit',
      );
      expect(
        matchCommits(_commits(), 'a1b2c3d4e5f6').single.shortSha,
        'a1b2c3d',
      );
    });

    test('matches the author name and email', () {
      expect(matchCommits(_commits(), 'ana').single.authorName, 'Ana');
      expect(
        matchCommits(_commits(), 'luis@example').single.authorName,
        'Luis',
      );
    });

    test('matches a ref name', () {
      final results = matchCommits(_commits(), 'main');
      expect(results, hasLength(1));
      expect(results.single.messageTitle, 'feat: history view');
    });

    test('returns nothing when no commit matches', () {
      expect(matchCommits(_commits(), 'zzz-no-such-thing'), isEmpty);
    });
  });
}
