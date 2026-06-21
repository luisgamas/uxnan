import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/threads_screen.dart';

Thread _thread(
  String id,
  String title,
  String agentId, {
  String? cwd,
  String? projectId,
}) =>
    Thread(
      id: id,
      title: title,
      agentId: agentId,
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
      lastActivity: DateTime(2026, 6, 6, 10, 30),
      cwd: cwd,
      projectId: projectId,
    );

Widget _wrap({required List<Thread> threads}) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => const ThreadsScreen(deviceId: 'mac-1'),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      threadsProvider.overrideWith((ref) => Stream.value(threads)),
      threadActivityProvider.overrideWith(
        (ref) => Stream.value(const <String, ThreadActivity>{}),
      ),
      unreadThreadsProvider.overrideWith(
        (ref) => Stream.value(const <String>{}),
      ),
      // No live bridge in the widget test: report no auth info so tiles keep
      // their normal status dot (the real provider would hit the session).
      authStatusProvider.overrideWith((ref, agentId) => null),
      trustedDevicesProvider
          .overrideWith((ref) => Stream.value(const <TrustedDevice>[])),
      connectedDeviceProvider.overrideWith((ref) => Stream.value(null)),
      connectingDeviceProvider.overrideWith((ref) => Stream.value(null)),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
}

void main() {
  testWidgets('renders a tile per thread with agent filter chips', (
    tester,
  ) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex'),
          _thread('b', 'Add dark mode', 'claude-code'),
        ],
      ),
    );
    await tester.pump();

    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsOneWidget);
    // Two distinct agents → an "All" chip plus one per agent.
    expect(find.widgetWithText(ChoiceChip, 'All'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Codex'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Claude Code'), findsOneWidget);
  });

  testWidgets('filters threads when an agent chip is selected', (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex'),
          _thread('b', 'Add dark mode', 'claude-code'),
        ],
      ),
    );
    await tester.pump();

    await tester.tap(find.widgetWithText(ChoiceChip, 'Codex'));
    await tester.pump();

    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsNothing);
  });

  testWidgets('shows the empty state when there are no threads', (
    tester,
  ) async {
    await tester.pumpWidget(_wrap(threads: const []));
    await tester.pump();

    expect(find.text('No threads yet'), findsOneWidget);
  });

  testWidgets('long-pressing a thread opens the actions menu', (tester) async {
    await tester.pumpWidget(
      _wrap(threads: [_thread('th-9', 'Fix the login bug', 'codex')]),
    );
    await tester.pump();

    await tester.longPress(find.text('Fix the login bug'));
    await tester.pumpAndSettle();

    expect(find.text('Rename'), findsOneWidget);
    expect(find.text('Copy thread ID'), findsOneWidget);
    expect(find.text('Delete'), findsOneWidget);
    // The sheet header shows the thread id for reference.
    expect(find.text('th-9'), findsOneWidget);
  });

  testWidgets('shows the scope selector with Agent as the default scope',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex'),
          _thread('b', 'Add dark mode', 'claude-code'),
        ],
      ),
    );
    await tester.pump();

    // The scope selector is an ActionChip on the left of the filter bar
    // (a menu trigger, not a toggle). The default scope is Agent, so it
    // shows the "Agent" label.
    expect(find.widgetWithText(ActionChip, 'Agent'), findsOneWidget);
    // The agent filter chips are to its right.
    expect(find.widgetWithText(ChoiceChip, 'All'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Codex'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Claude Code'), findsOneWidget);
  });

  testWidgets('switching to Project scope swaps agent chips for project chips',
      (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex', cwd: '/home/me/app'),
          _thread('b', 'Add dark mode', 'claude-code', cwd: '/home/me/lib'),
          _thread('c', 'Refactor utils', 'codex', cwd: '/home/me/app'),
        ],
      ),
    );
    await tester.pump();

    // Pre-condition: agent scope is active → agent chips are visible.
    expect(find.widgetWithText(ChoiceChip, 'Codex'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Claude Code'), findsOneWidget);
    // No project chips yet.
    expect(find.widgetWithText(ChoiceChip, 'app'), findsNothing);
    expect(find.widgetWithText(ChoiceChip, 'lib'), findsNothing);

    // Tap the scope selector → menu opens with both options.
    await tester.tap(find.widgetWithText(ActionChip, 'Agent'));
    await tester.pumpAndSettle();
    // The popup menu items reuse the same labels.
    expect(find.text('Agent'), findsNWidgets(2)); // selector + menu item
    expect(find.text('Project'), findsOneWidget);

    // Pick "Project" → the selector label flips, the agent chips disappear,
    // and the project chips appear (one per distinct cwd).
    await tester.tap(
      find.text('Project').last,
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();

    expect(find.widgetWithText(ActionChip, 'Project'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'Codex'), findsNothing);
    expect(find.widgetWithText(ChoiceChip, 'Claude Code'), findsNothing);
    expect(find.widgetWithText(ChoiceChip, 'app'), findsOneWidget);
    expect(find.widgetWithText(ChoiceChip, 'lib'), findsOneWidget);
    // "All" is still present (it's the reset chip in the project bar too).
    expect(find.widgetWithText(ChoiceChip, 'All'), findsOneWidget);
  });

  testWidgets(
      "switching scope clears the other dimension's filter so the two stay "
      'independent', (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Fix the login bug', 'codex', cwd: '/home/me/app'),
          _thread('b', 'Add dark mode', 'claude-code', cwd: '/home/me/lib'),
        ],
      ),
    );
    await tester.pump();

    // Filter to Codex.
    await tester.tap(find.widgetWithText(ChoiceChip, 'Codex'));
    await tester.pump();
    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsNothing);

    // Switch to Project scope → the agent filter is cleared so all threads
    // show again (no project filter selected yet → "All" project).
    await tester.tap(find.widgetWithText(ActionChip, 'Agent'));
    await tester.pumpAndSettle();
    await tester.tap(
      find.text('Project').last,
      warnIfMissed: false,
    );
    await tester.pumpAndSettle();

    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsOneWidget);
  });
}
