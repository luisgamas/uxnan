import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_diff_totals.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/commit_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_actions_sheet.dart';

/// A fixture repo state for these widget tests (kept out of production code).
GitRepoState _sampleState() => const GitRepoState(
      branch: 'feature/login',
      upstream: 'origin/feature/login',
      isDirty: true,
      ahead: 2,
      diffTotals: GitDiffTotals(
        additions: 24,
        deletions: 6,
        changedFileCount: 3,
      ),
      changedFiles: [
        GitChangedFile(
          path: 'lib/presentation/screens/login/login_screen.dart',
          status: GitFileStatus.modified,
          additions: 18,
          deletions: 4,
        ),
        GitChangedFile(
          path: 'lib/application/auth/login_controller.dart',
          status: GitFileStatus.added,
          additions: 6,
        ),
        GitChangedFile(
          path: 'lib/legacy/old_login.dart',
          status: GitFileStatus.deleted,
          deletions: 2,
        ),
      ],
    );

Widget _wrap(Widget child, {GitRepoState? state}) => ProviderScope(
      overrides: [
        gitRepoStateProvider.overrideWith((ref) => Stream.value(state)),
        gitActiveActionProvider.overrideWith((ref) => Stream.value(null)),
      ],
      child: MaterialApp(
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: child),
      ),
    );

void main() {
  testWidgets('GitActionsSheet renders branch, files and actions from state',
      (tester) async {
    await tester.pumpWidget(
      _wrap(const GitActionsSheet(), state: _sampleState()),
    );
    await tester.pump();

    expect(find.text('feature/login'), findsOneWidget);
    expect(find.text('login_screen.dart'), findsOneWidget);
    expect(find.text('Commit'), findsOneWidget);
    expect(find.text('Push'), findsOneWidget);
  });

  testWidgets('GitActionsSheet shows the empty state with no repo', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(const GitActionsSheet()));
    await tester.pump();

    expect(find.text('No git repository'), findsOneWidget);
  });

  testWidgets('CommitSheet enables the action once a message is typed', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(const CommitSheet()));
    await tester.pump();

    final commitButton = find.widgetWithText(FilledButton, 'Commit');
    expect(tester.widget<FilledButton>(commitButton).onPressed, isNull);

    await tester.enterText(find.byType(TextField), 'feat: add login');
    await tester.pump();

    expect(tester.widget<FilledButton>(commitButton).onPressed, isNotNull);
  });
}
