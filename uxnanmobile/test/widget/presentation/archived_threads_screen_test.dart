import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/screens/threads/archived_threads_screen.dart';

Thread _thread(
  String id,
  String title, {
  ThreadStatus status = ThreadStatus.active,
}) =>
    Thread(
      id: id,
      title: title,
      agentId: 'codex',
      deviceId: 'mac-1',
      syncState: ThreadSyncState.synced,
      status: status,
      lastActivity: DateTime(2026, 6, 6, 10, 30),
    );

Widget _wrap({required List<Thread> threads}) {
  final router = GoRouter(
    routes: [
      GoRoute(
        path: '/',
        builder: (_, __) => const ArchivedThreadsScreen(deviceId: 'mac-1'),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      threadsProvider.overrideWith((ref) => Stream.value(threads)),
    ],
    child: MaterialApp.router(
      routerConfig: router,
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
    ),
  );
}

void main() {
  testWidgets('lists only the archived threads', (tester) async {
    await tester.pumpWidget(
      _wrap(
        threads: [
          _thread('a', 'Active one'),
          _thread('b', 'Archived one', status: ThreadStatus.archived),
        ],
      ),
    );
    await tester.pump();

    expect(find.text('Archived one'), findsOneWidget);
    expect(find.text('Active one'), findsNothing);
  });

  testWidgets('shows the empty state when there are no archived threads',
      (tester) async {
    await tester.pumpWidget(_wrap(threads: [_thread('a', 'Active one')]));
    await tester.pump();

    expect(find.text('No archived threads'), findsOneWidget);
  });
}
