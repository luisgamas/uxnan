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

Thread _thread(String id, String title, String agentId) => Thread(
      id: id,
      title: title,
      agentId: agentId,
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
      lastActivity: DateTime(2026, 6, 6, 10, 30),
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
}
