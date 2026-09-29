import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/managers/git_action_manager.dart';
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/domain/enums/git_file_status.dart';
import 'package:uxnan/domain/value_objects/git/git_changed_file.dart';
import 'package:uxnan/domain/value_objects/git/git_diff_totals.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/workspace/git/git_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import '../../support/ux_icon_finder.dart';

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

/// A manager whose `git/status` never answers with a repository — what a
/// folder that is not one (or an unreachable PC) looks like to the screen.
GitActionManager _noRepoManager() => GitActionManager(
      domainEvents: const Stream<DomainEvent>.empty(),
      sendRequest: (method, [params]) =>
          Future.error(StateError('not a git repository')),
    );

Widget _wrap(Widget child, {GitRepoState? state}) => ProviderScope(
      overrides: [
        gitActionManagerProvider.overrideWith((ref) => _noRepoManager()),
        gitRepoStateProvider.overrideWith((ref, cwd) => Stream.value(state)),
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
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
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
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
    await tester.pump();

    // Every file row's `_NeCheckbox` is initially selected →
    // `UxIcons.check` (the on-state glyph). The selection-bar checkbox
    // (tristate) lives separately as the all-on glyph too, but tapping the
    // second per-file
    // checkbox is what flips one file's selection state.
    final checks = findUxIcon(UxIcons.check);
    expect(checks, findsAtLeastNWidgets(3));
    await tester.tap(checks.at(1));
    await tester.pump();

    expect(find.text('2 of 3 selected'), findsOneWidget);
  });

  testWidgets('GitScreen shows the clean state when there are no changes', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        const GitScreen(cwd: '/repo'),
        state: const GitRepoState(branch: 'main'),
      ),
    );
    await tester.pump();

    expect(find.text('No changes to commit'), findsOneWidget);
  });

  testWidgets('GitScreen opens without raising the keyboard', (tester) async {
    // Only the conversation opens with its keyboard up. Git is opened as often
    // to read what changed as to commit, and on a tablet the keyboard covered
    // half the pane before anything was chosen.
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
    await tester.pumpAndSettle();

    final editable =
        tester.widget<EditableText>(find.byType(EditableText).first);
    expect(editable.focusNode.hasPrimaryFocus, isFalse);
  });

  testWidgets(
      'Git commit composer contracts when idle and matches focused elevation',
      (tester) async {
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField).first);
    await tester.pumpAndSettle();

    final surface = find.byKey(const ValueKey('git-composer-surface'));
    final focusedSize = tester.getSize(surface);
    expect(tester.widget<Material>(surface).elevation, 2);

    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();

    final idleSize = tester.getSize(surface);
    expect(idleSize.width, lessThan(focusedSize.width));
    expect(idleSize.height, lessThan(focusedSize.height));
    expect(tester.widget<Material>(surface).elevation, 0);
  });

  testWidgets(
      'GitScreen keeps the tap-outside-to-unfocus behavior on the '
      'commit title field', (tester) async {
    // Mirrors the conversation screen test: the GestureDetector wrapping the
    // timeline (CustomScrollView) calls FocusManager.primaryFocus.unfocus on
    // tap, and the commit title — once focused — must drop focus when
    // the user taps the timeline area.
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byType(TextField).first);
    await tester.pumpAndSettle();

    // Pre-condition: the title field is focused.
    expect(
      FocusManager.instance.primaryFocus,
      isNotNull,
      reason: 'tapping the title field should have focused it',
    );

    // Tap the timeline area (a SliverList region) → primary focus drops.
    await tester.tap(find.text('feature/login'));
    await tester.pumpAndSettle();

    final titleEditable =
        tester.widget<EditableText>(find.byType(EditableText).first);
    expect(titleEditable.focusNode.hasPrimaryFocus, isFalse);
  });

  testWidgets(
      'GitScreen no longer renders a Refresh button in the app bar '
      '(refresh moved to pull-to-refresh)', (tester) async {
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
    await tester.pumpAndSettle();

    // The pull-to-refresh gesture lives on the timeline; the app bar no
    // longer carries a dedicated refresh action. The `UxIcons.refresh`
    // glyph must not appear anywhere on screen.
    expect(findUxIcon(UxIcons.refresh), findsNothing);

    // And the RefreshIndicator must be wired into the scroll surface.
    expect(find.byType(RefreshIndicator), findsOneWidget);
  });

  testWidgets(
      'GitScreen exposes the History action in the app bar when a repo '
      'is present', (tester) async {
    await tester.pumpWidget(
      _wrap(const GitScreen(cwd: '/repo'), state: _sampleState()),
    );
    await tester.pump();

    // The History IconSurface is in the app bar with the "View history"
    // tooltip. It's disabled while the screen is busy.
    final historyTooltip = find.byTooltip('View history');
    expect(historyTooltip, findsOneWidget);
  });

  testWidgets(
      'GitScreen says the folder is not a repository once status answers '
      'without one, instead of loading forever', (tester) async {
    await tester.pumpWidget(_wrap(const GitScreen(cwd: '/notes')));
    // The first frame asks; until the answer lands it is still loading.
    expect(find.text('No git repository'), findsNothing);

    await tester.pump();
    await tester.pump();

    expect(find.text('No git repository'), findsOneWidget);
  });
}
