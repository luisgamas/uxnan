import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/git/git_repo_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/conversation/git/commit_sheet.dart';
import 'package:uxnan/presentation/screens/conversation/git/git_actions_sheet.dart';

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
      _wrap(const GitActionsSheet(), state: GitRepoState.sample()),
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
