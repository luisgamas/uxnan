import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/application/services/workspace_grouping.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/agent_run_state.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/agent_run_state_provider.dart';
import 'package:uxnan/presentation/screens/threads/workspace_details_sheet.dart';

/// The folder details sheet is sized by what it has to say, not by how long
/// the folder has been in use.
///
/// It used to lay every conversation out in one scroll: a folder with a long
/// history grew the sheet into a full-screen page, with its drag handle tucked
/// under the status bar where it could not be grabbed.
Future<void> main() async {
  const statusBar = 24.0;
  const screen = Size(400, 800);

  WorkspaceGroup folder(int conversations) => WorkspaceGroup(
        key: '/dev/app',
        label: 'app',
        threads: [
          for (var i = 0; i < conversations; i++)
            Thread(
              id: 't$i',
              title: 'Conversation $i',
              agentId: 'codex',
              syncState: ThreadSyncState.synced,
              status: ThreadStatus.active,
            ),
        ],
      );

  Future<void> open(WidgetTester tester, WorkspaceGroup group) async {
    tester.view.physicalSize = screen;
    tester.view.devicePixelRatio = 1;
    tester.view.padding = const FakeViewPadding(top: statusBar);
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          // A row's state mark reads the live activity stream; a sheet test
          // has no session behind it.
          agentRunStatusProvider.overrideWith(
            (ref, id) =>
                (state: AgentRunState.idle, errored: false, stale: false),
          ),
        ],
        child: MaterialApp(
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Builder(
            builder: (context) => Scaffold(
              body: TextButton(
                onPressed: () => showWorkspaceDetails(
                  context,
                  group,
                  fullPath: null,
                  onOpenThread: (_) {},
                ),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    );
    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();
  }

  testWidgets('a long history does not take over the screen', (tester) async {
    await open(tester, folder(60));

    final sheet = tester.getRect(find.byType(BottomSheet));
    expect(
      sheet.top,
      greaterThan(screen.height * 0.25),
      reason: 'the sheet grew into a full-screen page',
    );
    // The list scrolls inside the sheet instead of stretching it.
    expect(find.text('Conversation 0'), findsOneWidget);
    expect(find.text('Conversation 59'), findsNothing);
  });

  testWidgets('its handle is never under the status bar', (tester) async {
    await open(tester, folder(60));

    final sheet = tester.getRect(find.byType(BottomSheet));
    expect(sheet.top, greaterThanOrEqualTo(statusBar));
  });

  testWidgets('a short folder still opens just as tall as it needs',
      (tester) async {
    await open(tester, folder(2));

    expect(find.text('Conversation 0'), findsOneWidget);
    expect(find.text('Conversation 1'), findsOneWidget);
    final sheet = tester.getRect(find.byType(BottomSheet));
    expect(sheet.height, lessThan(screen.height * 0.5));
  });
}
