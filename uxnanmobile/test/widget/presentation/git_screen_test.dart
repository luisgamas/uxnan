import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_diff_totals.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_screen.dart';

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
        home: child,
      ),
    );

void main() {
  testWidgets('GitScreen lists changed files with branch and commit composer',
      (tester) async {
    await tester.pumpWidget(_wrap(const GitScreen(), state: _sampleState()));
    await tester.pump();

    expect(find.text('feature/login'), findsOneWidget);
    expect(find.text('login_screen.dart'), findsOneWidget);
    // Every file selected by default → "3 of 3 selected".
    expect(find.text('3 of 3 selected'), findsOneWidget);
    // The commit composer is present (borderless title field + commit button).
    expect(find.text('Commit title'), findsOneWidget);
    expect(find.byTooltip('Commit'), findsOneWidget);
  });

  testWidgets('GitScreen unchecks a file, lowering the selected count', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(const GitScreen(), state: _sampleState()));
    await tester.pump();

    // The first per-file checkbox (after the select-all one) toggles selection.
    final checkboxes = find.byType(Checkbox);
    await tester.tap(checkboxes.at(1));
    await tester.pump();

    expect(find.text('2 of 3 selected'), findsOneWidget);
  });

  testWidgets('GitScreen shows the clean state when there are no changes', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        const GitScreen(),
        state: const GitRepoState(branch: 'main'),
      ),
    );
    await tester.pump();

    expect(find.text('No changes to commit'), findsOneWidget);
  });
}
