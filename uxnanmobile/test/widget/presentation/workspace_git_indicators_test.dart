import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/workspace_git_provider.dart';
import 'package:uxnan/presentation/screens/threads/workspace_git_indicators.dart';

/// A dense row survives on what it leaves out. These pin the three rules that
/// keep it readable — and the one that keeps it honest.
Future<void> main() async {
  const cwd = '/dev/app';

  List<GitChangedFile> files(int n) => [
        for (var i = 0; i < n; i++)
          GitChangedFile(path: 'f$i.dart', status: GitFileStatus.modified),
      ];

  Future<void> pump(
    WidgetTester tester, {
    required GitRepoState? git,
    bool stale = false,
  }) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          workspaceGitProvider(cwd).overrideWith(
            (ref) async => (git: git, stale: stale),
          ),
        ],
        child: const MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(body: WorkspaceGitIndicators(cwd: cwd)),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('a zero is never drawn', (tester) async {
    await pump(
      tester,
      git: const GitRepoState(branch: 'main'),
    );

    // "↑0" is not information; it is noise that has to be read before it can
    // be discarded.
    expect(find.textContaining('0'), findsNothing);
    expect(find.textContaining('↑'), findsNothing);
    expect(find.textContaining('↓'), findsNothing);
  });

  testWidgets('nothing known draws nothing — never "clean"', (tester) async {
    await pump(tester, git: null);

    // The dangerous failure here is a row that says "clean" for a folder it
    // could not reach: a lie that looks exactly like good news.
    expect(find.byType(Text), findsNothing);
  });

  testWidgets('uncommitted work, ahead and behind all show', (tester) async {
    await pump(
      tester,
      git: GitRepoState(
        branch: 'main',
        isDirty: true,
        ahead: 2,
        behind: 5,
        changedFiles: files(3),
      ),
    );

    expect(find.text('3'), findsOneWidget);
    expect(find.text('↑2'), findsOneWidget);
    expect(find.text('↓5'), findsOneWidget);
  });

  testWidgets('at most three signals reach the row', (tester) async {
    await pump(
      tester,
      git: GitRepoState(
        branch: 'main',
        isDirty: true,
        ahead: 1,
        behind: 1,
        changedFiles: files(9),
      ),
    );

    // Three is the cap; anything more belongs in the long-press sheet, where
    // there is room to spell it out.
    expect(find.byType(Text), findsNWidgets(3));
  });

  testWidgets('a remembered answer is dimmed, not hidden', (tester) async {
    await pump(
      tester,
      stale: true,
      git: GitRepoState(branch: 'main', isDirty: true, changedFiles: files(2)),
    );

    // Still there — losing it the moment a PC drops would throw away the only
    // information the row has.
    final text = tester.widget<Text>(find.text('2'));
    expect(text.style!.color!.a, lessThan(1.0));
  });
}
