import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/domain/enums/thread_activity.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/domain/value_objects/thread_queue_state.dart';
import 'package:uxnan/l10n/app_localizations.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';
import 'package:uxnan/presentation/providers/thread_preview_provider.dart';
import 'package:uxnan/presentation/screens/threads/threads_screen.dart';
import 'package:uxnan/presentation/theme/icons.dart';
import 'package:uxnan/presentation/widgets/agent_logo.dart';
import 'package:uxnan/presentation/widgets/agent_status_indicator.dart';
import '../../support/ux_icon_finder.dart';

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

Widget _wrap({
  required List<Thread> threads,
  Map<String, ThreadActivity> activity = const {},
  List<Project> projects = const [],
}) {
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
      // The row's reply preview reads the message store; a list test has no
      // database, and pulling the real one in leaves drift timers pending.
      threadPreviewProvider.overrideWith((ref, key) async => null),
      threadsProvider.overrideWith((ref) => Stream.value(threads)),
      // The list is grouped by project now, so the screen reads the bridge's
      // roots. Feeding them keeps the real request (and its transport) out.
      projectsProvider.overrideWith((ref) async => projects),
      // A held queue is one of the things that blocks a thread, so the
      // queue stream is part of the row's state too.
      threadQueuesProvider.overrideWith(
        (ref) => Stream.value(const <String, ThreadQueueState>{}),
      ),
      // The row's state now includes "the agent asked and is waiting on
      // you", which the manager tracks; feed it directly so the real one
      // (drift, transport, its poll timers) stays out of a widget test.
      awaitingInputProvider.overrideWith(
        (ref) => Stream.value(const <String, Set<String>>{}),
      ),
      threadActivityProvider.overrideWith((ref) => Stream.value(activity)),
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
  testWidgets('renders a tile per conversation, with no filter chips',
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
    await tester.pump();

    expect(find.text('Fix the login bug'), findsOneWidget);
    expect(find.text('Add dark mode'), findsOneWidget);
    // The grouping and the two orderings replaced them.
    expect(find.byType(FilterChip), findsNothing);
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

  testWidgets('a row reads state, then who, then what', (tester) async {
    await tester
        .pumpWidget(_wrap(threads: [_thread('t1', 'Claude', 'Fix it')]));
    await tester.pumpAndSettle();

    // The order `uxnandesktop` reads in, and the order the eye needs: whether a
    // row wants you decides whether you read the rest of it.
    final indicator = tester.getTopLeft(find.byType(AgentStatusIndicator)).dx;
    final logo = tester.getTopLeft(find.byType(AgentLogo)).dx;
    final title = tester.getTopLeft(find.text('Claude')).dx;
    expect(indicator, lessThan(logo));
    expect(logo, lessThan(title));

    // The mark identifies and the indicator only signals, so the mark is the
    // larger of the two — and neither is a 44 dp avatar competing with the
    // text beside it.
    expect(
      tester.getSize(find.byType(AgentLogo)).width,
      greaterThan(tester.getSize(find.byType(AgentStatusIndicator)).width),
    );
  });

  testWidgets('agent marks carry no border and no shadow', (tester) async {
    await tester
        .pumpWidget(_wrap(threads: [_thread('t1', 'Claude', 'Fix it')]));
    await tester.pumpAndSettle();

    // A framed, shadowed tile inside a card read as the CARD having a shadow —
    // which is what it looked like, and why this is asserted rather than
    // trusted.
    final boxes = tester.widgetList<Container>(
      find.descendant(
        of: find.byType(AgentLogo),
        matching: find.byType(Container),
      ),
    );
    for (final box in boxes) {
      final decoration = box.decoration;
      if (decoration is! BoxDecoration) continue;
      expect(decoration.border, isNull);
      expect(decoration.boxShadow, anyOf(isNull, isEmpty));
    }
  });

  group('folders', () {
    Thread inFolder(String id, String title, String cwd) => Thread(
          id: id,
          title: title,
          agentId: 'claude-code',
          syncState: ThreadSyncState.synced,
          status: ThreadStatus.active,
          cwd: cwd,
        );

    testWidgets('a folder heads its conversations and counts them',
        (tester) async {
      await tester.pumpWidget(
        _wrap(
          threads: [
            inFolder('a', 'Fix login', '/dev/app'),
            inFolder('b', 'Dark mode', '/dev/app'),
            inFolder('c', 'Docs', '/dev/web'),
          ],
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('app'), findsOneWidget);
      expect(find.text('web'), findsOneWidget);
      // Second line: how much is in there, without opening it.
      expect(find.text('2 conversations'), findsOneWidget);
      expect(find.text('1 conversation'), findsOneWidget);
    });

    testWidgets('closing a folder hides its rows but not its state',
        (tester) async {
      await tester.pumpWidget(
        _wrap(threads: [inFolder('a', 'Fix login', '/dev/app')]),
      );
      await tester.pump();
      await tester.pump();

      await tester.tap(find.text('app'));
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.text('Fix login'), findsNothing);
      // A closed folder still reports what is happening inside it — otherwise
      // closing one hides the very thing the screen exists for.
      expect(find.byType(AgentStatusIndicator), findsWidgets);
    });

    testWidgets('long-pressing a folder opens its details with the full path',
        (tester) async {
      await tester.pumpWidget(
        _wrap(threads: [inFolder('a', 'Fix login', '/dev/app')]),
      );
      await tester.pump();
      await tester.pump();

      await tester.longPress(find.text('app'));
      await tester.pump(const Duration(milliseconds: 400));

      // The row shows a name; two folders can share one, so the path that
      // tells them apart lives here.
      expect(find.text('/dev/app'), findsOneWidget);
      expect(find.text('Copy path'), findsOneWidget);
    });

    testWidgets('a sibling worktree is just another folder', (tester) async {
      await tester.pumpWidget(
        _wrap(
          threads: [
            inFolder('a', 'On main', '/dev/app'),
            inFolder('b', 'On a branch', '/dev/app--feature'),
          ],
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(find.text('app'), findsOneWidget);
      expect(find.text('app--feature'), findsOneWidget);
    });

    testWidgets('every folder offers to start a conversation in it',
        (tester) async {
      await tester.pumpWidget(
        _wrap(threads: [inFolder('a', 'Fix login', '/dev/app')]),
      );
      await tester.pump();
      await tester.pump();

      expect(findUxIcon(UxIcons.add), findsOneWidget);
    });
  });
}
